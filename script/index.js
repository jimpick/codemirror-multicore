const CodeMirror = require('codemirror')
const css = require('sheetify')
const html = require('choo/html')
const devtools = require('choo-devtools')
const choo = require('choo')
const storage = require('random-access-idb')('codemirror-multicore')
const websocket = require('websocket-stream')
const pump = require('pump')
const Multicore = require('./multicore')

require('codemirror/mode/htmlmixed/htmlmixed')
css('codemirror/lib/codemirror.css')

const app = choo()
app.use(devtools())
app.use(store)
app.route('/', mainView)
app.mount('#choo')

function mainView (state, emit) {
  let link = ''
  if (state.currentArchive) {
    const url = `dat://${state.currentArchive.key.toString('hex')}`
    link = html`<a href=${url}>${url}</a>`
  }
  return html`
    <div>
      <h2>
        Create a webpage on the Peer-to-Peer Web!
      </h2>
      <button class="saveBtn" onclick=${() => emit('save')}>
        Save
      </button>
      <span class="link">
        ${link}
      </span>
    </div>
  `
}

function store (state, emitter) {
  state.archives = {}
  state.currentArchive = null

  const multicore = new Multicore(storage)
  multicore.ready(() => {
    const archive = multicore.createArchive()
    const archiverKey = multicore.archiver.changes.key.toString('hex')
    emitter.on('save', () => {
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
          state.currentArchive = archive
          emitter.emit('render')
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
}

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


