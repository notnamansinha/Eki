/**
 * The user's approved portrait and landscape paintings, shared by the login
 * page and persistent passenger shell. Native picture selection follows the
 * CSS viewport (including rotation and mobile desktop mode), then srcset
 * selects a delivery size for its pixel density. PNG masters are archived
 * outside public/ so the deployed app contains only the optimized WebPs.
 */
export default function TransitArtwork() {
  return (
    <div className="transit-artwork" aria-hidden="true">
      <picture>
        <source
          media="(orientation: portrait)"
          type="image/webp"
          srcSet="/images/bus-background-portrait-trees-480.webp 480w, /images/bus-background-portrait-trees-768.webp 768w, /images/bus-background-portrait-trees-841.webp 841w"
          sizes="(max-aspect-ratio: 841/1870) 44.9733dvh, 100vw"
          width={841}
          height={1870}
        />
        <source
          type="image/webp"
          srcSet="/images/bus-background-landscape-trees-960.webp 960w, /images/bus-background-landscape-trees-1280.webp 1280w, /images/bus-background-landscape-trees-1672.webp 1672w"
          sizes="(max-aspect-ratio: 1672/941) 177.6834dvh, 100vw"
          width={1672}
          height={941}
        />
        <img
          src="/images/bus-background-landscape-trees-1672.webp"
          width={1672}
          height={941}
          alt=""
          fetchPriority="high"
          loading="eager"
          decoding="async"
        />
      </picture>
      <div className="transit-artwork-shade" />
    </div>
  );
}
