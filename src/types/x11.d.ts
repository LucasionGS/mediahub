// Minimal typings for the parts of the `x11` package MediaHub uses.
declare module "x11" {
  export interface XEvent {
    type: number;
    name: string;
    wid: number;
    atom: number;
    state: number;
  }

  export interface XProperty {
    type: number;
    format: number;
    bytesAfter: number;
    data: Buffer;
  }

  type Callback<T> = (error: Error | null, result: T) => void;

  export interface XClient {
    InternAtom(onlyIfExists: boolean, name: string, callback: Callback<number>): void;
    GetProperty(del: number, wid: number, name: number, type: number, longOffset: number, longLength: number, callback: Callback<XProperty>): void;
    ChangeProperty(mode: number, wid: number, name: number, type: number, units: 8 | 16 | 32, data: number[] | Buffer | string): void;
    DeleteProperty(wid: number, name: number): void;
    ChangeWindowAttributes(wid: number, values: { eventMask?: number }): void;
    on(event: "event", listener: (event: XEvent) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "end" | "close", listener: () => void): this;
    terminate(): void;
  }

  export interface XDisplay {
    client: XClient;
    screen: { root: number }[];
  }

  export function createClient(options: { display?: string }, callback: (error: Error | null, display: XDisplay) => void): XClient;

  export const eventMask: Record<string, number>;
}
