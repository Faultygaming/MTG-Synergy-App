// cytoscape-cose-bilkent is a layout extension that registers itself via
// cytoscape.use(). It exports a function as its default; the function has
// no public callable shape we care about beyond being passed to .use().
declare module "cytoscape-cose-bilkent" {
  const ext: unknown;
  export default ext;
}
