'use client';

interface Step {
  number: number;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  accentColor?: string;
}

export function StepIndicator({ steps, currentStep, accentColor = '#D4A847' }: StepIndicatorProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '28px',
      }}
    >
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.number;
        const isActive = currentStep === step.number;
        const isLast = index === steps.length - 1;

        return (
          <div
            key={step.number}
            style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : 1 }}
          >
            {/* Circle + label */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isCompleted
                    ? '#1E3A5F'
                    : isActive
                    ? accentColor
                    : '#E1E5EB',
                  color: isCompleted ? '#FFFFFF' : isActive ? '#1A1A2E' : '#6B7280',
                  fontSize: '13px',
                  fontWeight: 700,
                  flexShrink: 0,
                  transition: 'all 0.25s ease',
                  boxShadow: isActive ? `0 0 0 4px ${accentColor}30` : 'none',
                }}
              >
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  step.number
                )}
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#1A1A2E' : isCompleted ? '#1E3A5F' : '#6B7280',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.2s ease',
                }}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: '2px',
                  margin: '-18px 8px 0',
                  backgroundColor: isCompleted ? '#1E3A5F' : '#E1E5EB',
                  transition: 'background-color 0.25s ease',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default StepIndicator;
