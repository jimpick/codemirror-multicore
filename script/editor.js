const Nanocomponent = require('nanocomponent')
const html = require('choo/html')
const CodeMirror = require('codemirror')
const css = require('sheetify')
const template = require('./template')

require('codemirror/mode/htmlmixed/htmlmixed')
css('codemirror/lib/codemirror.css')

class Editor extends Nanocomponent {
  constructor () {
    super()
    this.color = null
  }

  createElement () {
    return html`<div id="editor"></div>`
  }
  
  load (el) {
    this.codemirror = CodeMirror(el, {
      lineNumbers: true,
      mode: 'text/html',
      value: template
    })
  }

  // Implement conditional rendering
  update () {
    return false
  }
}

module.exports = Editor