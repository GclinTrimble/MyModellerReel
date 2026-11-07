# Turn survey points into a surface

You have surveyed points (a CSV or text file with number, northing, easting, elevation and code) and want a ground surface that follows the kerbs and stays live.

![Turn survey points into a surface](media/survey-points-to-surface/survey-points-to-surface.gif)

## In the app

1. **Site › Import points** [Import points](action:importPoints): pick the file and its column order (PNEZD…). The first point sets the base point, so big coordinates stay exact.
   ![Site › Import points Import points: pick the file and its column order (PNEZD…).](media/survey-points-to-surface/01.jpg)
2. **Site › Feature code…** tells the app what codes mean: KERB joins into a breakline, TREE places a tree. **Site › Process codes** applies them.
   ![Site › Feature code… tells the app what codes mean: KERB joins into a breakline,](media/survey-points-to-surface/02.jpg)
3. **Site › Create surface (TIN)…** [Create surface](action:surface): a triangulated surface that honours the breaklines. Move a point and it rebuilds.
   ![Site › Create surface (TIN)… Create surface: a triangulated surface that honours](media/survey-points-to-surface/03.jpg)
4. **Site › Check surface** [Check surface](action:checkSurface) flags spikes, pits, duplicates and thin triangles, with the points to fix.
   ![Site › Check surface Check surface flags spikes, pits, duplicates and thin trian](media/survey-points-to-surface/04.jpg)

## Ask the copilot

> Import C:\survey\site.csv (PNEZD), make KERB a breakline and TREE a tree, then build the existing ground surface and check it.

The copilot runs the same commands as the steps above; with **AI › Propose AI changes for review** on, you accept or reject its changes first.

## From a script, the HTTP API or MCP

```js
await api.import_points({ path: 'C:/survey/site.csv', format: 'PNEZD' });
await api.define_feature_code({ code: 'KERB', line: true, breakline: true, color: '#c8553d' });
await api.process_codes({});
const s = await api.create_surface({ name: 'Existing ground' });
await api.check_surface({ id: s.id });
```

## Good to know

- The Survey tab lists every point; edit northings, eastings, elevations and codes in place.
- LandXML points and surfaces come in with **File › Import** too.

## Related

- [Work out cut and fill for a building pad](howto:cut-and-fill-for-a-pad)
- [Bring in a LandXML, IFC or DXF file](howto:bring-in-landxml-ifc-dxf)
