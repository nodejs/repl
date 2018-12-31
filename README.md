# Node.js REPL Prototype

Goals:

- Better debugging and interaction
  - Language Server Protocol
  - Runtime inspection
  - Benchmarking
- Pretty UI
  - Highlight output *and* input
  - autocomplete
- Keep the code neat for future changes

## Usage

### Install
1. clone `@nodejs/repl` locally
    ```sh
    git clone https://github.com/nodejs/repl.git
    ```
1. `cd` to the project directory
    ```sh
    cd repl
    ```
1. install project dependencies (locally)
    ```sh
    npm install
    ```
1. install `@nodejs/repl` as a global npm package
    ```sh
    npm link
    ```

### Run
```sh
node-prototype-repl
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
