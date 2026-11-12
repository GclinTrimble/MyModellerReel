# Edit a surface by hand: swap triangles, delete them, points, outline and holes

Your surface from survey points is nearly right: a few triangles cross a ridge the wrong way, a long sliver spans a gap, a pond should be left out, or the edge should stop at the site boundary.

![Edit a surface by hand](media/edit-a-surface-by-hand/edit-a-surface-by-hand.gif)

## In the app

1. Select the surface and pick **Site › [Edit surface](action:editSurface)** (or right-click the surface). The status bar lists the keys.
   ![Edit surface](media/edit-a-surface-by-hand/01.jpg)
2. **D** delete: click a triangle to remove it. **W** swap: click near an edge to turn it the other way between its two points. **A** add a point on the surface; **R** leave a point out (the survey point itself stays). **U** restores everything.
   ![Delete and swap](media/edit-a-surface-by-hand/02.jpg)
3. **H** hole: click the corners of an area to leave out (a pond, a building), Enter to finish.
   ![A hole](media/edit-a-surface-by-hand/03.jpg)
4. **B** outline: click the corners of the boundary the surface stays inside, Enter to finish. Type `max 30` to drop triangles with a side longer than 30 m (edges of a scattered survey), or `min 0.5` to drop slivers.
   ![An outline](media/edit-a-surface-by-hand/04.jpg)

The surface stays live: move or add a survey point and it rebuilds with your edits kept.

## Ask Plumb

> On Existing ground, leave out point 2_2, drop triangles longer than 30 m, and cut a hole around the pond.

## From a script, the HTTP API or MCP

```js
await api.edit_triangles({ id: 'Existing ground', action: 'delete', at: [7, -8] });
await api.edit_triangles({ id: 'Existing ground', action: 'swap', a: '2_2', b: '3_3' });
await api.edit_triangles({ id: 'Existing ground', action: 'remove_point', a: '2_2' });
await api.set_surface_sources({ id: 'Existing ground', max_edge: 30, min_edge: 0.5 });
await api.set_surface_sources({ id: 'Existing ground', voids: [[[14, -14], [21, -14], [21, -21], [14, -21]]] });
await api.set_surface_sources({ id: 'Existing ground', outline: [[0, -2], [25, 0], [25, -25], [3, -22]] });
```

## Good to know

- Swap works on an edge between two survey points.
- An outline or a hole made of survey points (Site › Boundary) works too and moves with its points.

## Related

- [Turn survey points into a surface](howto:survey-points-to-surface)
- [Read the terrain: contours, slopes and checks](howto:read-the-terrain)
