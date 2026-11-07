// Small, hand-written exchange files in the shape the usual tools write them (licence-clean test data).

// Civil 3D style: units, a TIN surface with an invisible face, an alignment with a curve and a vertical profile
export const LANDXML_C3D = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-10-01" time="10:00:00">
  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/></Units>
  <CoordinateSystem desc="Test grid" epsgCode="32631"/>
  <Project name="Riverside"/>
  <Application name="Autodesk Civil 3D" manufacturer="Autodesk, Inc." version="2026"/>
  <Surfaces>
    <Surface name="EG" desc="Existing ground">
      <Definition surfType="TIN" area2DSurf="200">
        <Pnts>
          <P id="1">5400000 650000 100</P>
          <P id="2">5400000 650020 101</P>
          <P id="3">5400010 650020 102</P>
          <P id="4">5400010 650000 101.5</P>
          <P id="5">5400020 650010 103</P>
        </Pnts>
        <Faces>
          <F>1 2 3</F>
          <F>1 3 4</F>
          <F i="1">4 3 5</F>
        </Faces>
      </Definition>
      <SourceData><Breaklines><Breakline name="Kerb"><PntList3D>5400000 650000 100 5400010 650020 102</PntList3D></Breakline></Breaklines></SourceData>
    </Surface>
  </Surfaces>
  <Alignments name="Roads">
    <Alignment name="Access road" length="45.708" staStart="1000">
      <CoordGeom>
        <Line><Start>5400000 650000</Start><End>5400000 650020</End></Line>
        <Curve rot="ccw" radius="10"><Start>5400000 650020</Start><Center>5400010 650020</Center><End>5400010 650030</End></Curve>
        <Spiral length="10"><Start>5400010 650030</Start><End>5400020 650030</End></Spiral>
      </CoordGeom>
      <Profile name="Access road"><ProfAlign name="Design"><PVI>1000 100</PVI><ParaCurve length="10">1020 101</ParaCurve><PVI>1045.708 100.5</PVI></ProfAlign></Profile>
    </Alignment>
  </Alignments>
  <Parcels><Parcel name="Lot 1"/></Parcels>
</LandXML>`;

// Trimble Business Center style: points with codes, a 3D plan feature, a point reference
export const LANDXML_TBC = `<?xml version="1.0"?>
<LandXML version="1.2" xmlns="http://www.landxml.org/schema/LandXML-1.2">
  <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>
  <Application name="Trimble Business Center" manufacturer="Trimble" version="2026.1"/>
  <CgPoints>
    <CgPoint name="1001" code="CP" desc="Control">5400100.000 650100.000 102.345</CgPoint>
    <CgPoint name="1002" code="KERB B">5400105.000 650110.000 102.400</CgPoint>
    <CgPoint name="1003" code="KERB E">5400105.000 650120.000 102.500</CgPoint>
    <CgPoint name="ref" pntRef="1001"/>
  </CgPoints>
  <PlanFeatures name="Linework">
    <PlanFeature name="Fence">
      <CoordGeom>
        <Line><Start>5400090 650090 101</Start><End>5400090 650130 101.2</End></Line>
        <Line><Start>5400090 650130 101.2</Start><End>5400120 650130 101.4</End></Line>
      </CoordGeom>
    </PlanFeature>
  </PlanFeatures>
</LandXML>`;

// A CAD drawing in millimetres: layers (one off, one locked, one dashed), a bulged polyline, a circle,
// a block inserted twice, two 3D faces, a point and a text
const pairs = (list) => `${list.map(([c, v]) => `${c}\n${v}`).join('\n')}\n`;
export const DXF_MM = pairs([
  [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'],
  [0, 'LAYER'], [2, 'C-KERB'], [70, 0], [62, 1], [6, 'CONTINUOUS'],
  [0, 'LAYER'], [2, 'C-CL'], [70, 0], [62, 8], [6, 'DASHED'],
  [0, 'LAYER'], [2, 'NOTES'], [70, 0], [62, -3], [6, 'CONTINUOUS'],
  [0, 'LAYER'], [2, 'A-FURN'], [70, 4], [62, 30], [6, 'CONTINUOUS'],
  [0, 'ENDTAB'], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'BLOCKS'],
  [0, 'BLOCK'], [8, '0'], [2, 'POST'], [70, 0], [10, 0], [20, 0], [30, 0],
  [0, '3DFACE'], [8, 'A-FURN'], [10, 0], [20, 0], [30, 0], [11, 100], [21, 0], [31, 0], [12, 100], [22, 0], [32, 1000], [13, 0], [23, 0], [33, 1000],
  [0, 'ENDBLK'], [8, '0'],
  [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'ENTITIES'],
  [0, 'LWPOLYLINE'], [8, 'C-KERB'], [90, 3], [70, 0], [10, 0], [20, 0], [42, 0], [10, 10000], [20, 0], [42, 1], [10, 10000], [20, 10000],
  [0, 'LINE'], [8, 'C-CL'], [10, 0], [20, -5000], [30, 0], [11, 20000], [21, -5000], [31, 0],
  [0, 'CIRCLE'], [8, 'C-KERB'], [10, 30000], [20, 0], [30, 0], [40, 2000],
  [0, 'INSERT'], [8, 'A-FURN'], [2, 'POST'], [10, 5000], [20, 5000], [30, 0], [50, 90],
  [0, 'INSERT'], [8, 'A-FURN'], [2, 'POST'], [10, 8000], [20, 5000], [30, 0],
  [0, '3DFACE'], [8, 'C-KERB'], [10, 0], [20, 20000], [30, 0], [11, 1000], [21, 20000], [31, 0], [12, 1000], [22, 21000], [32, 500], [13, 1000], [23, 21000], [33, 500],
  [0, 'POINT'], [8, 'NOTES'], [10, 1000], [20, 2000], [30, 300],
  [0, 'TEXT'], [8, 'NOTES'], [10, 0], [20, 0], [30, 0], [40, 250], [1, 'Kerb line'],
  [0, 'HATCH'], [8, 'C-KERB'],
  [0, 'ENDSEC'], [0, 'EOF'],
]);
