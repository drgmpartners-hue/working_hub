/**
 * CategoryGroup component.
 * Accordion-style group that shows a category header and expands to reveal
 * a list of ProgramCard items. Uses framer-motion for smooth animation.
 */
'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ProgramCard } from './ProgramCard';

export interface Program {
  title: string;
  description: string;
  href: string;
}

export interface CategoryGroupProps {
  /** Category name displayed in the header */
  name: string;
  /** Icon element rendered beside the category name */
  icon: React.ReactNode;
  /** Programs belonging to this category */
  programs: Program[];
  /** Subtle background tint for the header (hex or rgba) */
  headerBg?: string;
  /** Accent colour passed down to ProgramCard */
  accentColor?: string;
  /** Badge label (e.g. program count string) */
  badge?: string;
}

const chevronVariants = {
  open: { rotate: 180 },
  closed: { rotate: 0 },
};

const contentVariants = {
  open: {
    height: 'auto',
    opacity: 1,
    transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  },
  closed: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  },
};

export function CategoryGroup({
  name,
  icon,
  programs,
  headerBg = '#F0F4FA',
  accentColor = '#4A90D9',
  badge,
}: CategoryGroupProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      style={{
        borderRadius: '16px',
        border: '1.5px solid #E1E5EB',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}
    >
      {/* Accordion Header */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '18px 24px',
          backgroundColor: isOpen ? headerBg : '#FFFFFF',
          border: 'none',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease',
          outline: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.backgroundColor = '#F8FAFC';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.backgroundColor = '#FFFFFF';
          }
        }}
      >
        {/* Category icon */}
        <span
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: isOpen ? accentColor : '#F0F4FA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background-color 0.2s ease',
          }}
        >
          <span
            style={{
              color: isOpen ? '#FFFFFF' : accentColor,
              transition: 'color 0.2s ease',
              lineHeight: 0,
            }}
          >
            {icon}
          </span>
        </span>

        {/* Category name + badge */}
        <div style={{ flex: 1, textAlign: 'left' }}>
          <span
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#1A1A2E',
              letterSpacing: '-0.2px',
            }}
          >
            {name}
          </span>
          {badge && (
            <span
              style={{
                marginLeft: '10px',
                fontSize: '12px',
                fontWeight: 600,
                color: accentColor,
                backgroundColor: `${accentColor}18`,
                borderRadius: '20px',
                padding: '2px 9px',
              }}
            >
              {badge}
            </span>
          )}
        </div>

        {/* Chevron */}
        <motion.span
          variants={chevronVariants}
          animate={isOpen ? 'open' : 'closed'}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isOpen ? accentColor : '#6B7280'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.span>
      </button>

      {/* Animated Content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            variants={contentVariants}
            initial="closed"
            animate="open"
            exit="closed"
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '4px 20px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                borderTop: `1px solid ${accentColor}22`,
              }}
            >
              {programs.map((program) => (
                <ProgramCard
                  key={program.href}
                  title={program.title}
                  description={program.description}
                  href={program.href}
                  accentColor={accentColor}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default CategoryGroup;
