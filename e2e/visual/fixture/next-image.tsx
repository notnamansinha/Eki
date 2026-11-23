// Stand-in for next/image: a plain <img> with the same intrinsic size.
import type { ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & { src: string; priority?: boolean; unoptimized?: boolean; fill?: boolean };

export default function Image({ priority, unoptimized, fill, ...props }: ImageProps) {
  void unoptimized;
  void fill;
  return <img {...props} loading={priority ? "eager" : props.loading} />;
}
