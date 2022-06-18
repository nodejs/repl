# Node.js REPL Prototype

Goals:

- Better debugging and interaction
  - Runtime inspection
  - Benchmarking
- Pretty UI
  - Highlight output *and* input
  - autocomplete
- Keep the code neat for future changes

## Usage

![](https://gc.gy/123280943.png)  
![](https://gc.gy/123280961.png)  
![](https://gc.gy/123280991.png)  
![](https://gc.gy/123281010.png)  
![](https://gc.gy/123281037.png)  
![](https://gc.gy/123281084.png)  
![](https://gc.gy/123281118.png)

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
