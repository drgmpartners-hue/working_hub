'use client';

import { ReactNode, useRef, useState } from 'react';

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

const getPositionStyle = (position: TooltipProps['position']): React.CSSProperties => {
  switch (position) {
    case 'bottom':
      return {
        top: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
      };
    case 'left':
      return {
        right: 'calc(100% + 8px)',
        top: '50%',
        transform: 'translateY(-50%)',
      };
    case 'right':
      return {
        left: 'calc(100% + 8px)',
        top: '50%',
        transform: 'translateY(-50%)',
      };
    case 'top':
    default:
      return {
        bottom: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
      };
  }
};

const getArrowStyle = (position: TooltipProps['position']): React.CSSProperties => {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
  };

  switch (position) {
    case 'bottom':
      return {
        ...base,
        top: -5,
        left: '50%',
        transform: 'translateX(-50%)',
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderBottom: '5px solid rgba(30, 41, 59, 0.95)',
      };
    case 'left':
      return {
        ...base,
        right: -5,
        top: '50%',
        transform: 'translateY(-50%)',
        borderTop: '5px solid transparent',
        borderBottom: '5px solid transparent',
        borderLeft: '5px solid rgba(30, 41, 59, 0.95)',
      };
    case 'right':
      return {
        ...base,
        left: -5,
        top: '50%',
        transform: 'translateY(-50%)',
        borderTop: '5px solid transparent',
        borderBottom: '5px solid transparent',
        borderRight: '5px solid rgba(30, 41, 59, 0.95)',
      };
    case 'top':
    default:
      return {
        ...base,
        bottom: -5,
        left: '50%',
        transform: 'translateX(-50%)',
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderTop: '5px solid rgba(30, 41, 59, 0.95)',
      };
  }
};

export const Tooltip = ({
  text,
  children,
  position = 'top',
  delay = 300,
}: TooltipProps) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  const wrapperStyle: React.CSSProperties = {
    display: 'inline-flex',
    position: 'relative',
  };

  const tooltipStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 500,
    borderRadius: 6,
    padding: '6px 10px',
    maxWidth: 260,
    wordBreak: 'keep-all',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
    pointerEvents: 'none',
    zIndex: 9999,
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.15s ease',
    ...getPositionStyle(position),
  };

  return (
    <div
      style={wrapperStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <div style={tooltipStyle} role="tooltip">
        <span style={getArrowStyle(position)} />
        {text}
      </div>
    </div>
  );
};

export default Tooltip;
