import type { ImgHTMLAttributes } from "react";
// next/image needs the Next.js runtime; the landing page only uses it for its logo.
export default function Image({ priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) {
  return <img {...props} />;
}
