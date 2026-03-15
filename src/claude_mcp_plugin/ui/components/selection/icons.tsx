import { h } from "preact";

export function FilterIcon(props: { icon: string; color: string }) {
  var c = props.color;
  var s = 1.083;
  switch (props.icon) {
    case "cursor":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={c} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.2 1.6l2.7 10.2 1.8-3.6 3.6-1.8z" />
          <line x1="6.7" y1="8.2" x2="10.8" y2="11.9" />
        </svg>
      );
    case "type":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={c} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2.7 2.2 2.7 4.3 10.3 4.3 10.3 2.2" />
          <line x1="6.5" y1="4.3" x2="6.5" y2="10.8" />
        </svg>
      );
    case "hash":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={c} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.2" y1="5.4" x2="10.8" y2="5.4" />
          <line x1="2.2" y1="8.1" x2="10.8" y2="8.1" />
          <line x1="4.9" y1="2.2" x2="3.8" y2="10.8" />
          <line x1="9.2" y1="2.2" x2="8.1" y2="10.8" />
        </svg>
      );
    case "layers":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={c} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <polygon points="6.5 1.1 1.1 3.8 6.5 6.5 11.9 3.8" />
          <polyline points="1.1 6.5 6.5 9.2 11.9 6.5" />
          <polyline points="1.1 9.2 6.5 11.9 11.9 9.2" />
        </svg>
      );
    case "variable":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={c} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.3 1.6c-1.4 0-2 .8-2 2s.7 1.5.7 2.2c0 .4-.7.7-.7.7s.7.3.7.7c0 .7-.7 1-.7 2.2s.6 2 2 2" />
          <path d="M8.7 1.6c1.4 0 2 .8 2 2s-.7 1.5-.7 2.2c0 .4.7.7.7.7s-.7.3-.7.7c0 .7.7 1 .7 2.2s-.6 2-2 2" />
        </svg>
      );
    case "palette":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={c} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="6.5" r="5.4" />
          <circle cx="5.2" cy="5.2" r="0.9" fill={c} stroke="none" />
          <circle cx="7.8" cy="5.2" r="0.9" fill={c} stroke="none" />
          <circle cx="6.5" cy="7.8" r="0.9" fill={c} stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

function getIconColor(type: string): string {
  switch (type) {
    case "COMPONENT":
      return "#0fa958";
    case "COMPONENT_SET":
    case "INSTANCE":
    default:
      return "#9ca3af";
  }
}

export function TypeIcon(props: { type: string }) {
  var color = getIconColor(props.type);
  var s = 1.083;
  switch (props.type) {
    case "PAGE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.7 1.1h5.2l2.6 2.6v7.6a1.1 1.1 0 01-1.1 1.1H3.8a1.1 1.1 0 01-1.1-1.1V2.2a1.1 1.1 0 011.1-1.1z" />
          <polyline points="7.9 1.1 7.9 3.7 10.5 3.7" />
        </svg>
      );
    case "FRAME":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.2" y1="4.9" x2="10.8" y2="4.9" />
          <line x1="2.2" y1="8.1" x2="10.8" y2="8.1" />
          <line x1="4.9" y1="2.2" x2="4.9" y2="10.8" />
          <line x1="8.1" y1="2.2" x2="8.1" y2="10.8" />
        </svg>
      );
    case "SECTION":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" />
          <line x1="1.6" y1="5.4" x2="11.35" y2="5.4" />
        </svg>
      );
    case "GROUP":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" stroke-dasharray="2 1.5" />
        </svg>
      );
    case "TEXT":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2.2 2.2 2.2 3.8 10.8 3.8 10.8 2.2" />
          <line x1="6.5" y1="3.8" x2="6.5" y2="10.8" />
          <line x1="4.9" y1="10.8" x2="8.1" y2="10.8" />
        </svg>
      );
    case "RECTANGLE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" />
        </svg>
      );
    case "ELLIPSE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="6.5" r="5.4" />
        </svg>
      );
    case "LINE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.7" y1="6.5" x2="10.3" y2="6.5" />
        </svg>
      );
    case "VECTOR":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="2.7" r="1.6" />
          <path d="M6.5 4.3L2.2 10.8h8.6z" />
          <circle cx="10.3" cy="6.5" r="1.1" />
        </svg>
      );
    case "COMPONENT":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.25 1.1L5.4 3.25 3.25 5.4 1.1 3.25z" />
          <path d="M9.75 1.1L11.9 3.25 9.75 5.4 7.6 3.25z" />
          <path d="M3.25 7.6L5.4 9.75 3.25 11.9 1.1 9.75z" />
          <path d="M9.75 7.6L11.9 9.75 9.75 11.9 7.6 9.75z" />
        </svg>
      );
    case "COMPONENT_SET":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.25 1.1L5.4 3.25 3.25 5.4 1.1 3.25z" />
          <path d="M9.75 1.1L11.9 3.25 9.75 5.4 7.6 3.25z" />
          <path d="M3.25 7.6L5.4 9.75 3.25 11.9 1.1 9.75z" />
          <path d="M9.75 7.6L11.9 9.75 9.75 11.9 7.6 9.75z" />
        </svg>
      );
    case "INSTANCE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.1L11.9 6.5 6.5 11.9 1.1 6.5z" />
        </svg>
      );
    case "POLYGON":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.6L11.4 10.8H1.6z" />
        </svg>
      );
    case "STAR":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.1l1.7 3.4 3.7.5-2.7 2.6.6 3.7-3.3-1.7-3.3 1.7.6-3.7L1.1 5l3.7-.5z" />
        </svg>
      );
    case "BOOLEAN_OPERATION":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.3 2.7c0 1.5.6 2.7 2.2 3.8" />
          <path d="M8.7 2.7c0 1.5-.6 2.7-2.2 3.8" />
          <path d="M6.5 6.5v4.3" />
          <circle cx="6.5" cy="11.4" r="1.4" />
        </svg>
      );
    case "SLICE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="4.3" cy="4.3" r="1.6" />
          <circle cx="4.3" cy="9.75" r="1.6" />
          <line x1="5.7" y1="3.5" x2="11.4" y2="1.1" />
          <line x1="5.7" y1="10.5" x2="11.4" y2="8.1" />
        </svg>
      );
    case "IMAGE":
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" />
          <circle cx="4.6" cy="4.6" r="1.1" />
          <polyline points="11.35 8.1 8.7 5.4 1.6 11.35" />
        </svg>
      );
    default:
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" />
        </svg>
      );
  }
}
