import * as React from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'light';
  showTagline?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { width: 140, height: 50 },
  md: { width: 180, height: 65 },
  lg: { width: 240, height: 85 },
  xl: { width: 320, height: 115 },
};

// Use the actual PNG logo since it has the proper design
export function Logo({ 
  size = 'md', 
  variant = 'default',
  showTagline = true, 
  className,
}: LogoProps) {
  const { width, height } = sizeMap[size];
  
  return (
    <Image
      src="/images/logo.png"
      alt="হাসনাহেনা - Hasnahena"
      width={width}
      height={showTagline ? height : Math.round(height * 0.7)}
      className={cn(
        'object-contain',
        variant === 'light' && 'brightness-0 invert',
        className
      )}
      priority
    />
  );
}

// Icon-only version (pinwheel only) for small spaces
export function LogoIcon({ 
  className, 
  size = 40,
  variant = 'default',
}: { 
  className?: string;
  size?: number;
  variant?: 'default' | 'light';
}) {
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      className={cn('flex-shrink-0', className)}
      aria-label="Hasnahena"
    >
      <g transform="translate(5, 5)">
        {/* Pinwheel design matching the original logo */}
        {/* Top-right petal - Cyan/Teal */}
        <path
          d="M35 35 L35 8 Q50 5 58 20 L35 35"
          fill={variant === 'light' ? '#ffffff' : '#4DD4AC'}
          fillOpacity={variant === 'light' ? 0.95 : 1}
        />
        {/* Right petal - Lime Green */}
        <path
          d="M35 35 L58 20 Q68 32 60 48 L35 35"
          fill={variant === 'light' ? '#ffffff' : '#84CC16'}
          fillOpacity={variant === 'light' ? 0.85 : 1}
        />
        {/* Top-left petal - Teal */}
        <path
          d="M35 35 L20 8 Q32 2 45 8 L35 35"
          fill={variant === 'light' ? '#ffffff' : '#2DD4BF'}
          fillOpacity={variant === 'light' ? 0.9 : 1}
        />
        {/* Left petal - Dark Blue */}
        <path
          d="M35 35 L8 25 Q2 40 12 55 L35 35"
          fill={variant === 'light' ? '#ffffff' : '#1E40AF'}
          fillOpacity={variant === 'light' ? 0.75 : 1}
        />
        {/* Bottom-left petal - Blue */}
        <path
          d="M35 35 L12 55 Q22 68 38 65 L35 35"
          fill={variant === 'light' ? '#ffffff' : '#3B82F6'}
          fillOpacity={variant === 'light' ? 0.8 : 1}
        />
        {/* Bottom petal - Navy */}
        <path
          d="M35 35 L38 65 Q55 65 60 48 L35 35"
          fill={variant === 'light' ? '#ffffff' : '#1E3A5F'}
          fillOpacity={variant === 'light' ? 0.7 : 1}
        />
        {/* Center dot */}
        <circle 
          cx="35" 
          cy="35" 
          r="3.5" 
          fill={variant === 'light' ? '#ffffff' : '#D1D5DB'}
        />
      </g>
    </svg>
  );
}
