import React from 'react';
import Image from 'next/image';

interface BorderedImageProps {
  src: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 64,
  md: 75,
  lg: 128,
} as const;

const BorderedImage: React.FC<BorderedImageProps> = ({ src, alt, size = 'md' }) => {
  const pixelSize = sizeMap[size];

  return (
    <div className={`relative w-${pixelSize} h-${pixelSize} rounded-full border-2 border-white p-1 overflow-hidden`}>
      <Image 
        src={src} 
        alt={alt} 
        width={pixelSize}
        height={pixelSize}
        className="rounded-full object-cover"
      />
    </div>
  );
};

export default BorderedImage;