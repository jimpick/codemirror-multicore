const CodeMirror = require('codemirror')
const css = require('sheetify')
const storage = require('random-access-idb')('codemirror-multicore')
const websocket = require('websocket-stream')
const pump = require('pump')
var Multicore = require('./multicore')

require('codemirror/mode/htmlmixed/htmlmixed')
css('codemirror/lib/codemirror.css')

const defaultDoc = `<html>
<head>
  <title>My Dat Page</title>
</head>
<body>
  <h1>My Dat Page</h1>

  This is my page published as a Dat archive.

  <footer>
    Published to the peer-to-peer web from the
    <a href="https://codemirror-multicore.glitch.me/">conventional web</a>.
  </footer>
</body>
</html>`

const editorEle = document.getElementById('editor')
const editor = CodeMirror(editorEle, {
  lineNumbers: true,
  mode: 'text/html',
  value: defaultDoc
})

const multicore = new Multicore(storage)
multicore.ready(() => {
  const saveButton = document.getElementById('saveBtn')
  const archive = multicore.createArchive()
  const archiverKey = multicore.archiver.changes.key.toString('hex')
  saveButton.addEventListener('click', () => {
    console.log('Archiver key:', archiverKey)
    const value = editor.getValue()
    archive.ready(() => {
      console.log('Key:', archive.key.toString('hex'))
      archive.writeFile('/index.html', value, err => {
        if (err) {
          console.error('Error writing to Dat', err)
          return
        }
        console.log('Success.')
      })
      multicore.replicateFeed(archive)
    })
  })
  archive.ready(() => {
    const host = document.location.host
    const url = `wss://${host}/archiver/${archiverKey}`
    const stream = websocket(url)
    pump(
      stream,
      multicore.archiver.replicate({encrypt: false}),
      stream
    )
  })
})

