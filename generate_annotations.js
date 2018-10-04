'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const types = Object.create(null);

const program = ts.createProgram([
  path.join(__dirname, 'node_modules', 'typescript', 'lib', 'lib.esnext.d.ts'),
], { noLib: true });

function parseTSFunction(func, { name: { text: receiver } }) {
  if (!func.name.escapedText) {
    return;
  }

  if (/Constructor$/.test(receiver)) {
    receiver = receiver.replace(/Constructor$/, '');
  }

  let receiverRec;
  receiverRec = types[receiver];
  if (receiverRec === undefined) {
    receiverRec = Object.create(null);
    types[receiver] = receiverRec;
  }

  const method = func.name.escapedText;

  const args = func.parameters
    .map((p) => {
      let text = p.name.escapedText;
      if (p.questionToken) {
        text = `?${text}`;
      }
      if (p.dotDotDotToken) {
        text = `...${text}`;
      }
      return text;
    })
    .filter((x) => x !== 'this');

  let entry = receiverRec[method];
  if (entry === undefined) {
    entry = [];
    receiverRec[method] = entry;
  }
  entry.push(args);
}

program.getSourceFiles().forEach((file) => {
  ts.forEachChild(file, (node) => {
    if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
      for (const member of node.members) {
        if (member.kind === ts.SyntaxKind.MethodSignature) {
          parseTSFunction(member, node);
        }
      }
    }
    if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
      parseTSFunction(node, { name: { text: 'globalThis' } });
    }
  });
});

fs.writeFileSync('./src/NativeFunctions.json', JSON.stringify(types));
