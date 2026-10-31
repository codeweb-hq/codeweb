// Regression suite for Python `async def` (issue #104). The Python symbol rule was
// /^\s*def\s+/, which does not match `async def`, so no async function or method became a
// node and every call into one was dropped or wired to the wrong same-named function.
//
// --no-ctags + engine regex force the deterministic regex scanner, the tier that owns NODES.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, cleanup, writeTree, hasEdge } from './helpers.mjs';
import { runExtract } from '../scripts/extract-symbols.mjs';

const FILES = {
  'svc.py':
    'async def fetch():\n' +
    '    return 1\n' +
    '\n' +
    'def sync():\n' +
    '    return 2\n' +
    '\n' +
    'class Client:\n' +
    '    async def get(self):\n' +
    '        return 3\n',
  'other.py':
    'def fetch():\n' +                       // same name in another module: the decoy
    '    return 0\n',
  'caller.py':
    'from svc import fetch\n' +
    '\n' +
    'async def main():\n' +
    '    return await fetch()\n',
};

let SRC;
before(() => { SRC = tmpDir('codeweb-pyasync-'); writeTree(SRC, FILES); });
after(() => cleanup(SRC));

async function extract() {
  const { fragment } = await runExtract({ path: SRC, target: 'pyasync-x', ctags: false, engine: 'regex' });
  return fragment;
}

test('an async def function becomes a node, like its sync sibling', async () => {
  const frag = await extract();
  const ids = frag.nodes.map((n) => n.id);
  assert.ok(ids.includes('svc.py:sync'), 'sync def is mapped');
  assert.ok(ids.includes('svc.py:fetch'), 'async def fetch is mapped');
});

test('an async def method becomes a node', async () => {
  const frag = await extract();
  assert.ok(frag.nodes.some((n) => n.id.startsWith('svc.py:') && n.id.endsWith('get')), 'async def get is mapped');
});

test('an async def itself is a caller: async main -> fetch is wired', async () => {
  const frag = await extract();
  assert.ok(frag.nodes.some((n) => n.id === 'caller.py:main'), 'async def main is mapped');
  assert.ok(hasEdge(frag.edges, 'caller.py:main', 'svc.py:fetch', 'call'),
    'main() awaits the imported svc.fetch -> edge to the async function');
});

test('the call does not fall through to the same-named function in another module', async () => {
  const frag = await extract();
  assert.ok(!hasEdge(frag.edges, 'caller.py:main', 'other.py:fetch'),
    'with svc.fetch mapped, no false cross-file edge to other.py:fetch');
});

test('inside async def helper, a module-qualified call to another helper() keeps its edge', async () => {
  const dir = tmpDir('codeweb-pyasync2-');
  try {
    writeTree(dir, {
      'a.py': 'import b\n\nasync def helper():\n    return b.helper()\n',
      'b.py': 'def helper():\n    return 1\n',
    });
    const { fragment } = await runExtract({ path: dir, target: 'pyasync-y', ctags: false, engine: 'regex' });
    assert.ok(hasEdge(fragment.edges, 'a.py:helper', 'b.py:helper', 'call'),
      'a same-named qualified call from an async function is not dropped');
  } finally { cleanup(dir); }
});
