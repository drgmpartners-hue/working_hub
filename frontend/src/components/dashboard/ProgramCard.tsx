/**
 * ProgramCard component.
 * Displays a program tile with title, description, and a navigation arrow.
 * Clicking the card navigates to the program's route.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

interface ProgramCardProps {
  title: string;
  description: string;
  href: string;
  accentColor?: string;
}

export function ProgramCard({
  title,
  description,
  href,
  accentColor = '#4A90D9',
}: ProgramCardProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      onClick={() => router.push(href)}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -2, scale: 1.005 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '16px',
        width: '100%',
        padding: '20px',
        borderRadius: '12px',
        border: hovered
          ? `1.5px solid ${accentColor}`
          : '1.5px solid #E1E5EB',
        backgroundColor: hovered ? '#FAFCFF' : '#FFFFFF',
        boxShadow: hovered
          ? '0 4px 16px rgba(74, 144, 217, 0.14)'
          : '0 1px 4px rgba(0,0,0,0.05)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          width: '3px',
          height: '40px',
          borderRadius: '2px',
          backgroundColor: hovered ? accentColor : '#E1E5EB',
          flexShrink: 0,
          transition: 'background-color 0.15s ease',
        }}
      />

      {/* Text block */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: '15px',
            fontWeight: 600,
            color: '#1A1A2E',
            letterSpacing: '-0.2px',
            lineHeight: 1.4,
          }}
        >
          {title}
        </p>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: '13px',
            color: '#6B7280',
            lineHeight: 1.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {description}
        </p>
      </div>

      {/* Arrow icon */}
      <motion.div
        animate={{ x: hovered ? 4 : 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          backgroundColor: hovered ? accentColor : '#F5F7FA',
          transition: 'background-color 0.15s ease',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={hovered ? '#FFFFFF' : '#6B7280'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: 'stroke 0.15s ease' }}
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </motion.div>
    </motion.button>
  );
}

export default ProgramCard;
