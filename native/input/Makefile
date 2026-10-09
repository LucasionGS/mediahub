BINARY := bin/mediahub-input

.PHONY: build run test vet lint clean

build:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(BINARY) ./cmd/mediahub-input

run: build
	./$(BINARY)

test:
	go test ./...

vet:
	go vet ./...

lint: vet
	gofmt -l .

clean:
	rm -rf bin
