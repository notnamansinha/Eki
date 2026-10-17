declare module "virtual:eki-route-fixture" {
  const fixture: { fixture: string; directions: Array<{ direction: string; encodedPolyline: string }> };
  export default fixture;
}
