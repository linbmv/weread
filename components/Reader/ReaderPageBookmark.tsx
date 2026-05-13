import React from 'react';

const ReaderPageBookmarkRibbon = ({ active }: { active: boolean }): React.JSX.Element => (
  <svg
    aria-hidden="true"
    focusable="false"
    height="46"
    viewBox="0 0 15 46"
    width="15"
    xmlns="http://www.w3.org/2000/svg"
  >
    {active ? (
      <path
        clipRule="evenodd"
        d="M7.5 40.9929L1.63072 45.7736C0.977232 46.3059 0 45.8399 0 44.9959V0.00020051C0 0.00020051 0.447715 0 1 0H14C14.5523 0 15 0 15 0V44.9959C15 45.8399 14.0228 46.3059 13.3693 45.7736L7.5 40.9929Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    ) : (
      <>
        <path
          className="reader-page-bookmark-hover-fill"
          clipRule="evenodd"
          d="M6.55393 39.8263C7.1051 39.3773 7.89491 39.3773 8.44609 39.8263L13.5 43.9429V0.00209606H1.50001V43.9429L6.55393 39.8263Z"
          fill="currentColor"
          fillRule="evenodd"
        />
        <path
          clipRule="evenodd"
          d="M6.55393 39.8263C7.1051 39.3773 7.89491 39.3773 8.44609 39.8263L13.5 43.9429V0.00209606H1.50001V43.9429L6.55393 39.8263ZM7.50001 40.9928L1.63073 45.7736C0.97724 46.3058 8.21054e-06 45.8398 8.21054e-06 44.9959C8.21054e-06 29.9975 0.000166956 14.9991 0 0.000782673C4.66666 -0.00482701 9.33335 -7.18569e-05 14 -7.18569e-05C14.2522 -7.18569e-05 15 -0.000323426 15 -0.000323426C15 -0.000323426 15 0.701317 15 1.0021V44.9959C15 45.8398 14.0228 46.3058 13.3693 45.7736L7.50001 40.9928Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      </>
    )}
  </svg>
);

export const ReaderPageBookmarkControl = ({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}): React.JSX.Element => {
  const label = active ? '点击移除标签' : '点击添加标签';
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };

  return (
    <div className="reader-page-bookmark-zone">
      <div className={`reader-page-bookmark-action-zone ${active ? 'is-active' : ''}`}>
        <button
          aria-label={label}
          aria-pressed={active}
          className={`reader-page-bookmark-button ${active ? 'is-active' : ''}`}
          type="button"
          onClick={onClick}
        >
          <ReaderPageBookmarkRibbon active={active} />
          <span className="reader-page-bookmark-tooltip">{label}</span>
        </button>
      </div>
    </div>
  );
};
