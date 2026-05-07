import type { SVGProps } from 'react';

type OcticonProps = SVGProps<SVGSVGElement>;

const baseProps = {
  'aria-hidden': true,
  fill: 'currentColor',
  focusable: 'false',
  height: 16,
  width: 16,
  xmlns: 'http://www.w3.org/2000/svg',
} as const;

export const OcticonMenu = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z" />
  </svg>
);

export const OcticonSearch = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
  </svg>
);

export const OcticonNote = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
  </svg>
);

export const OcticonBookmark = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M3 2.75C3 1.784 3.784 1 4.75 1h6.5c.966 0 1.75.784 1.75 1.75v11.5a.75.75 0 0 1-1.227.579L8 11.722l-3.773 3.107A.751.751 0 0 1 3 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.91l3.023-2.489a.75.75 0 0 1 .954 0l3.023 2.49V2.75a.25.25 0 0 0-.25-.25Z" />
  </svg>
);

export const OcticonReadingMode = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z" />
  </svg>
);

export const OcticonFont = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.75 13.25 8 2.75l4.25 10.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.4 9.75h5.2" strokeLinecap="butt" />
    </g>
  </svg>
);

export const OcticonSun = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.657-8.157a.75.75 0 0 1 0 1.061l-1.061 1.06a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.06-1.06a.75.75 0 0 1 1.06 0Zm-9.193 9.193a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0ZM3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm13 0a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8Zm-8 5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13Zm3.536-1.464a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061ZM2.343 2.343a.75.75 0 0 1 1.061 0l1.06 1.061a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-1.06-1.06a.75.75 0 0 1 0-1.06Z" />
  </svg>
);

export const OcticonMoon = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M9.598 1.591a.749.749 0 0 1 .785-.175 7.001 7.001 0 1 1-8.967 8.967.75.75 0 0 1 .961-.96 5.5 5.5 0 0 0 7.046-7.046.75.75 0 0 1 .175-.786Zm1.616 1.945a7 7 0 0 1-7.678 7.678 5.499 5.499 0 1 0 7.678-7.678Z" />
  </svg>
);

export const OcticonCopy = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
  </svg>
);

export const OcticonPlus = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
  </svg>
);

export const OcticonChevronRight = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
  </svg>
);

export const OcticonChevronLeft = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z" />
  </svg>
);

export const OcticonSortAsc = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="m12.927 2.573 3 3A.25.25 0 0 1 15.75 6H13.5v6.75a.75.75 0 0 1-1.5 0V6H9.75a.25.25 0 0 1-.177-.427l3-3a.25.25 0 0 1 .354 0ZM0 12.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75Zm0-4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8.25Zm0-4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.25Z" />
  </svg>
);

export const OcticonMarker = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <rect
      className="reader-selection-preview-fill"
      x="1.85"
      y="1.7"
      width="12"
      height="12"
      rx="2.5"
      fill="currentColor"
      fillOpacity="0.15"
    />
    <g fill="none" transform="translate(0, 1)" stroke="currentColor" strokeWidth="1.5">
      <path d="M4.25 11 8 2.5 11.75 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.6 8.25h4.8" strokeLinecap="butt" />
    </g>
  </svg>
);

export const OcticonWave = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4.25 11 8 2.5 11.75 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.6 8.25h4.8" strokeLinecap="butt" />
      <path
        className="reader-selection-preview-stroke"
        d="M3 13.5q.625-1 1.25 0t1.25 0t1.25 0t1.25 0t1.25 0t1.25 0t1.25 0t1.25 0"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1"
      />
    </g>
  </svg>
);

export const OcticonUnderline = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4.25 11 8 2.5 11.75 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.6 8.25h4.8" strokeLinecap="butt" />
      <path className="reader-selection-preview-stroke" d="M3 13.5h10" strokeLinecap="round" strokeWidth="1" />
    </g>
  </svg>
);

export const OcticonWriteNote = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.748 1.748 0 0 1 0 2.474l-8.609 8.61c-.21.21-.471.363-.757.445l-3.251.929a.748.748 0 0 1-.736-.191.748.748 0 0 1-.191-.736l.929-3.251a1.76 1.76 0 0 1 .445-.757Zm-7.549 9.67a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064l6.286-6.286L9.75 4.811Zm8.963-8.61a.252.252 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.252.252 0 0 0 0-.354Zm-.158 6.676A.246.246 0 0 1 12.502 9a.246.246 0 0 1 .232.163l.238.648a3.724 3.724 0 0 0 2.219 2.219l.649.238a.248.248 0 0 1 .16.202v.063a.248.248 0 0 1-.16.202l-.649.238a3.721 3.721 0 0 0-2.219 2.218l-.238.649a.246.246 0 0 1-.193.16h-.079a.245.245 0 0 1-.193-.16l-.239-.649a3.737 3.737 0 0 0-2.218-2.218l-.649-.238a.248.248 0 0 1-.118-.376.254.254 0 0 1 .118-.091l.649-.238a3.724 3.724 0 0 0 2.218-2.219Z" />
  </svg>
);

export const OcticonClearFormat = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <defs>
      <mask id="octicon-clear-format-mask">
        <rect width="16" height="16" fill="white" />
        <path d="M-2 1 L18 15" fill="none" stroke="black" stroke-width="1" transform="translate(0.75, -1)" />
      </mask>
    </defs>
    <g mask="url(#octicon-clear-format-mask)" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.75 13.25 L8 2.75 L12.25 13.25" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5.4 9.75 L10.6 9.75" stroke-linecap="butt" />
    </g>
    <path d="M2 3.8 L14 12.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
);

export const OcticonX = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
  </svg>
);

export const OcticonXCircle = (props: OcticonProps): React.JSX.Element => (
  <svg {...baseProps} viewBox="0 0 16 16" {...props}>
    <path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z" />
  </svg>
);
