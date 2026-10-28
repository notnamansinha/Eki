// Isolated stand-in for next/link so the real Profile and admin shell links
// render as anchors without a Next router.
import { forwardRef, type AnchorHTMLAttributes } from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean };
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ prefetch: _prefetch, ...props }, ref) {
  void _prefetch;
  return <a ref={ref} {...props} onClick={event => { event.preventDefault(); props.onClick?.(event); }} />;
});
export default Link;
export function useLinkStatus() { return { pending: false }; }
