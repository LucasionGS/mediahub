import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import Path from "node:path";
import EventEmitter from "node:events";
import { execFile, spawn } from "node:child_process";
import { app } from "electron";
import Paths from "./Paths";
import Settings from "./Settings";
import type { UpdateCommit, UpdateState, UpdateStatus } from "../shared/types";

/**
 * Where updates come from. A fork can point its hub at its own repository with `MEDIAHUB_UPDATE_REPOSITORY`.
 */
const REPOSITORY = process.env.MEDIAHUB_UPDATE_REPOSITORY || "https://github.com/LucasionGS/mediahub";
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_COMMITS = 10;
const NEEDS_SETUP_EXIT_CODE = 4; // From `setup.sh install-update`
const UNKNOWN_COMMAND_EXIT_CODE = 2; // setup.sh from before self-updating, which has no install-update
const BUILD_ROOT = Path.join(process.env.XDG_CACHE_HOME || Path.join(os.homedir(), ".cache"), "mediahub", "update");
const LOG_FILE = Path.join(Paths.LOGS, "update.log");
// Environment of the hub's own Electron process that must not reach npm and the build
const STRIPPED_ENV_PREFIXES = ["ELECTRON_", "npm_", "CHROME_"];
const STRIPPED_ENV = ["NODE_OPTIONS", "GOOGLE_API_KEY"];

/**
 * What `setup.sh` writes into each installed version.
 */
interface BuildInfo {
  version: string;
  commit: string;
  branch: string;
  builtAt: string;
}

/**
 * Keeps the hub up to date with its git repository: checks for new commits on the chosen branch, and installs them
 * by cloning that branch fresh and running its own `setup.sh install-update`, which builds the new version and
 * installs it next to the running one. The switch happens on the next restart.
 */
export class Updater {
  private constructor() { }

  public static readonly events = new EventEmitter();

  private static _installDir: string | null = null; // null = not installed in the versioned layout
  private static _state: UpdateState = {
    supported: false,
    repository: REPOSITORY,
    branch: "master",
    branches: [],
    installed: { version: app.getVersion(), commit: null, branch: null },
    latest: null,
    available: false,
    checking: false,
    lastChecked: null,
    status: "idle",
    progress: 0,
    message: null,
  };

  /**
   * Find out what's installed and start checking for updates in the background. Call once at startup.
   */
  public static init() {
    Updater._installDir = Updater.findInstallDir();
    const info = Updater.readBuildInfo();
    Updater._state.supported = Updater._installDir !== null;
    Updater._state.branch = Settings.get("updateBranch");
    Updater._state.installed = { version: info?.version ?? app.getVersion(), commit: info?.commit ?? null, branch: info?.branch ?? null };
    if (!Updater._state.supported) {
      Updater._state.message = app.isPackaged
        ? "Run ./setup.sh on the TV box once to let the hub update itself."
        : "Updating works in the installed hub, not in development.";
    }
    setTimeout(() => Updater.check().catch(() => undefined), FIRST_CHECK_DELAY_MS);
    setInterval(() => Updater.check().catch(() => undefined), CHECK_INTERVAL_MS);
  }

  public static getState(): UpdateState {
    return Updater._state;
  }

  /**
   * Ask the repository for the newest commit on the chosen branch, and list the branches there.
   */
  public static async check() {
    if (Updater._state.checking) return;
    Updater.patch({ checking: true });
    try {
      // Example:
      // 3536944c9be7a8f0e2b55c0f1e1b6d8b7a1c2d3e	refs/heads/master
      const output = await git(["ls-remote", "--heads", "--", REPOSITORY], 30000);
      const heads = new Map<string, string>();
      for (const line of output.trim().split("\n")) {
        const [sha, ref] = line.split("\t");
        if (sha && ref?.startsWith("refs/heads/")) heads.set(ref.slice("refs/heads/".length), sha);
      }
      const branch = Updater._state.branch;
      const branches = [...heads.keys()].sort((a, b) => Number(b === "master") - Number(a === "master") || a.localeCompare(b));
      const latest = heads.get(branch);
      if (!latest) {
        Updater.patch({
          branches, latest: null, available: false, lastChecked: Date.now(),
          message: `The branch "${branch}" doesn't exist in the repository. Pick another one.`,
        });
        return;
      }
      const installed = Updater._state.installed.commit;
      const commits = latest === installed ? [] : await Updater.fetchCommits(installed, latest).catch(() => []);
      Updater.patch({
        branches,
        latest: { commit: latest, commits },
        available: latest !== installed,
        lastChecked: Date.now(),
        // Don't hide what an update run reported, only stale check errors
        ...(Updater._state.status === "idle" && Updater._state.supported ? { message: null } : {}),
      });
    } catch (error) {
      console.error("Update check failed:", error);
      if (Updater._state.status === "idle") Updater.patch({ message: `Couldn't check for updates: ${(error as Error).message}` });
    } finally {
      Updater.patch({ checking: false });
    }
  }

  /**
   * Start installing the newest commit of the chosen branch. Returns once it has started; progress shows in the state.
   */
  public static async install() {
    if (!Updater._installDir) throw new Error(Updater._state.message ?? "This hub can't update itself.");
    if (Updater._state.status === "updating") return;
    Updater.patch({ status: "updating", progress: 0, message: "Starting the update" });
    Updater.runUpdate(Updater._installDir).catch(error => {
      console.error("Update failed:", error);
      Updater.finish("failed", `The update failed: ${(error as Error).message}`);
    });
  }

  /**
   * Switch to updating from another branch, and check it straight away.
   */
  public static async setBranch(branch: string) {
    if (!isSafeBranchName(branch)) throw new Error(`"${branch}" isn't a valid branch name.`);
    if (Updater._state.status === "updating") throw new Error("Wait for the update to finish before switching branches.");
    Settings.set("updateBranch", branch);
    Updater.patch({
      branch,
      latest: null,
      available: false,
      // A finished update was for the old branch, but it's installed all the same and still needs the restart
      ...(Updater._state.status === "ready" ? {} : { status: "idle" as const, message: null }),
    });
    await Updater.check();
  }

  private static async runUpdate(installDir: string) {
    const branch = Updater._state.branch;
    const workDir = Path.join(BUILD_ROOT, `build-${Date.now()}`);
    // Leftovers from an update that was cut short
    await removeDir(BUILD_ROOT);
    await fsp.mkdir(workDir, { recursive: true });
    const log = fs.createWriteStream(LOG_FILE);
    log.write(`[${new Date().toISOString()}] Updating from ${REPOSITORY} (${branch}) into ${installDir}\n`);

    try {
      Updater.patch({ progress: 0.01, message: "Downloading MediaHub" });
      await git(["clone", "--depth=1", `--branch=${branch}`, "--", REPOSITORY, workDir], CLONE_TIMEOUT_MS);
      const commit = (await git(["-C", workDir, "rev-parse", "HEAD"])).trim();
      log.write(`Cloned ${commit}\n`);

      const { code, error } = await Updater.runInstallScript(workDir, installDir, log);
      log.write(`[${new Date().toISOString()}] install-update exited with code ${code}\n`);
      if (code === 0) {
        Updater.finish("ready", `Version ${commit.slice(0, 7)} is installed. Restart MediaHub to start using it.`);
        Updater.events.emit("installed", "The MediaHub update is installed. Restart the hub to start using it.");
      }
      else if (code === NEEDS_SETUP_EXIT_CODE) {
        Updater.finish("needs-setup", error ?? "This update needs ./setup.sh to run on the TV box.");
      }
      else if (code === UNKNOWN_COMMAND_EXIT_CODE) {
        Updater.finish("failed", `The version on "${branch}" is from before the hub could update itself, so it can't be installed from here. Pick a newer branch, or run ./setup.sh update on the TV box.`);
      }
      else {
        Updater.finish("failed", `${error ?? "The update failed."} The details are in ${LOG_FILE.replace(os.homedir(), "~")}.`);
      }
    } finally {
      log.end();
      await removeDir(workDir).catch(() => undefined);
    }
  }

  /**
   * Run the new version's `setup.sh install-update`, following its progress. Resolves to its exit code and the last
   * error it printed.
   */
  private static runInstallScript(workDir: string, installDir: string, log: fs.WriteStream): Promise<{ code: number | null; error: string | null }> {
    const env: NodeJS.ProcessEnv = { ...process.env, MEDIAHUB_INSTALL_DIR: installDir };
    for (const key of Object.keys(env)) {
      if (STRIPPED_ENV.includes(key) || STRIPPED_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) delete env[key];
    }

    return new Promise((resolve, reject) => {
      // Low priority, so the TV stays responsive while it builds
      const child = spawn("nice", ["-n", "10", "bash", Path.join(workDir, "setup.sh"), "install-update"], { cwd: workDir, env });
      let error: string | null = null;
      let buffered = "";

      const onOutput = (chunk: Buffer) => {
        log.write(chunk);
        buffered += chunk.toString();
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const raw of lines) {
          // Strip colour codes from printf_red and friends
          const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim(); // eslint-disable-line no-control-regex
          // Example:
          // ::progress:: 40 Building the controller helper
          const progress = /^::progress:: (\d+) (.+)$/.exec(line);
          if (progress) Updater.patch({ progress: Math.min(1, parseInt(progress[1]) / 100), message: progress[2] });
          else if (line.startsWith("Error: ")) error = line.slice("Error: ".length);
        }
      };
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
      child.on("error", reject);
      child.on("close", code => resolve({ code, error }));
    });
  }

  /**
   * Commit subjects between the installed commit and `latest`, newest first. GitHub only; elsewhere it's empty.
   */
  private static async fetchCommits(installed: string | null, latest: string): Promise<UpdateCommit[]> {
    // Example:
    // https://github.com/LucasionGS/mediahub(.git)
    const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(REPOSITORY);
    if (!match) return [];
    const api = `https://api.github.com/repos/${match[1]}/${match[2]}`;
    const url = installed ? `${api}/compare/${installed}...${latest}` : `${api}/commits?sha=${latest}&per_page=${MAX_COMMITS}`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "MediaHub" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}.`);
    const body = await res.json() as { commits?: GitHubCommit[] } | GitHubCommit[];
    // Compare lists oldest first, the commits list newest first
    const list = Array.isArray(body) ? body : [...(body.commits ?? [])].reverse();
    return list.slice(0, MAX_COMMITS).map(c => ({ sha: c.sha, subject: c.commit.message.split("\n")[0] }));
  }

  /**
   * Folder the hub is installed in, like /opt/mediahub, when it's a version under `versions/`.
   * In development, `MEDIAHUB_INSTALL_DIR` points at an install to try updates against.
   */
  private static findInstallDir(): string | null {
    if (!app.isPackaged) return process.env.MEDIAHUB_INSTALL_DIR || null;
    const versionDir = Path.dirname(process.execPath);
    if (Path.basename(Path.dirname(versionDir)) !== "versions") return null; // Installed before self-updating existed
    return Path.dirname(Path.dirname(versionDir));
  }

  private static readBuildInfo(): BuildInfo | null {
    const dir = app.isPackaged ? Path.dirname(process.execPath) : Updater._installDir && Path.join(Updater._installDir, "current");
    if (!dir) return null;
    try {
      return JSON.parse(fs.readFileSync(Path.join(dir, "build-info.json"), "utf8"));
    } catch {
      return null;
    }
  }

  private static finish(status: UpdateStatus, message: string) {
    Updater.patch({ status, message, progress: status === "ready" ? 1 : Updater._state.progress });
  }

  private static patch(patch: Partial<UpdateState>) {
    Object.assign(Updater._state, patch);
    Updater.events.emit("change");
  }
}

interface GitHubCommit {
  sha: string;
  commit: { message: string };
}

/**
 * Branch names that are safe to hand to git: no option-like or path-escaping names.
 */
function isSafeBranchName(branch: string): boolean {
  return /^[\w][\w./-]*$/.test(branch) && !branch.includes("..") && !branch.endsWith("/") && branch.length <= 200;
}

/**
 * Delete a folder with `rm -rf`. Electron's `fs` treats .asar files as folders, so `fs.rm` can't delete a built app.
 */
function removeDir(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("rm", ["-rf", "--", dir], error => error ? reject(error) : resolve());
  });
}

function git(args: string[], timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error("git isn't installed."));
      reject(new Error(stderr.trim().split("\n").pop() || error.message));
    });
  });
}

export default Updater;
