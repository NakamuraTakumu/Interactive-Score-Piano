import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const setFavicon = () => {
  const href = `${import.meta.env.BASE_URL}favicon.svg?v=4`
  const rels = ['icon', 'shortcut icon']

  rels.forEach((rel) => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
    if (!link) {
      link = document.createElement('link')
      link.rel = rel
      document.head.appendChild(link)
    }
    link.type = 'image/svg+xml'
    link.href = href
  })
}

setFavicon()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
