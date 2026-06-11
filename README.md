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

#### Troubleshooting

If the above steps don't work, before running `node-prototype-repl`,
simply clone this repo, navigate to it and run

```sh
npm install
npm link
```

### Using as default Node.js REPL

Point environment variable `NODE_REPL_EXTERNAL_MODULE` to the result of `which node-prototype-repl`
or, on Windows, `where node-prototype-repl`

#### Troubleshooting

If it doesn't work, then point `NODE_REPL_EXTERNAL_MODULE` to `<your_local_git_repo_clone_path>/src/index.js`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).