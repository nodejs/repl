# Node.js REPL Prototype

![](https://gc.gy/39485171.png)
![](https://gc.gy/39485205.png)
![](https://gc.gy/39485229.png)
![](https://gc.gy/39485261.png)
![](https://gc.gy/39508489.png)
![](https://gc.gy/39485850.png)

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

```sh
$ npm install -g nodejs/repl
```

```sh
$ node-prototype-repl
```

If you want to use this REPL by default, you can point
`NODE_REPL_EXTERNAL_MODULE` to the result of
`which node-prototype-repl`!

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
