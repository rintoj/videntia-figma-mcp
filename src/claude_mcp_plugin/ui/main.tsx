// Import early-messages first to start capturing messages before Preact mounts
import './early-messages'
import { h, render } from 'preact'
import { App } from './app'
import './styles.css'

render(<App />, document.getElementById('root')!)
