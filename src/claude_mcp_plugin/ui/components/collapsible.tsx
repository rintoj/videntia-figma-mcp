import { h, ComponentChildren } from 'preact'
import { useRef, useEffect } from 'preact/hooks'

interface CollapsibleProps {
  expanded: boolean
  children: ComponentChildren
}

export function Collapsible({ expanded, children }: CollapsibleProps) {
  var contentRef = useRef<HTMLDivElement>(null)
  var initialRef = useRef(true)

  useEffect(function () {
    var el = contentRef.current
    if (!el) return

    if (initialRef.current) {
      initialRef.current = false
      if (expanded) {
        el.style.maxHeight = 'none'
        el.style.overflow = 'visible'
      } else {
        el.style.maxHeight = '0px'
        el.style.overflow = 'hidden'
      }
      return
    }

    if (expanded) {
      el.style.overflow = 'hidden'
      el.style.transition = 'none'
      el.style.maxHeight = '0px'
      void el.offsetHeight
      el.style.transition = 'max-height 0.2s ease'
      el.style.maxHeight = el.scrollHeight + 'px'
      var openTimer = setTimeout(function () {
        el.style.maxHeight = 'none'
        el.style.overflow = 'visible'
      }, 210)
      return function () { clearTimeout(openTimer) }
    } else {
      // Collapse: set explicit height, force layout, then animate to 0
      el.style.overflow = 'hidden'
      el.style.transition = 'none'
      el.style.maxHeight = el.scrollHeight + 'px'
      void el.offsetHeight
      el.style.transition = 'max-height 0.2s ease'
      el.style.maxHeight = '0px'
    }
  }, [expanded])

  return (
    <div ref={contentRef} class="collapsible">
      {children}
    </div>
  )
}
