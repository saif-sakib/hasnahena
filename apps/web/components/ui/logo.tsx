import * as React from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'light';
  showTagline?: boolean;
  className?: string;
  src?: string;
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
  src = '/images/logo.png',
}: LogoProps) {
  const { width, height } = sizeMap[size];
  
  return (
    <Image
      src={src}
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
