# OGC standards in MyModellerReel

MyModellerReel uses open formats and OGC standards ([ogc.org/standards](https://www.ogc.org/standards/)) for what comes in and what goes out. This page says, per standard, what is implemented, what is not, and which test covers it. The same list lives in the code (`CONFORMANCE` in [src/core/ogc.js](../../src/core/ogc.js)); `tests/ogc.test.js` fails when the two disagree.

MyModellerReel is a **client** of web services. OGC certification (TEAM Engine / CITE) tests servers, so there is no client certificate to get. What we can show is below: each implemented part, with a test against answers recorded from real services (GeoServer, MapServer, pygeoapi, EOX, PDOK). If MyModellerReel later serves its own data (OGC API - Features from the local HTTP API on 127.0.0.1:7717), the official OGC API - Features test suite applies to it, and the product can be registered in the OGC implementations database.

## Web services (client)

| Standard | Implemented | Not implemented | Tests |
|---|---|---|---|
| OGC WMTS 1.0.0 (07-057r7) | GetCapabilities; GetTile KVP; GetTile RESTful (ResourceURL template, dimensions) | GetFeatureInfo; SOAP | `tests/ogc.test.js` › WMTS |
| OGC Two Dimensional Tile Matrix Set 2.0 (17-083r4) | WebMercatorQuad (EPSG:3857) tile matrix sets, matched by scale denominators and top-left corner | Other tile matrix sets are listed but not drawn: use the service's WMS | `tests/ogc.test.js` › WMTS |
| OGC API - Tiles 1.0 (20-057) | core, tileset, collection map tiles in WebMercatorQuad | Vector tiles | `tests/ogc.test.js` › map layer commands |
| OGC WMS 1.3.0 (06-042) | GetCapabilities (nested layers, inherited CRS, attribution); GetMap in EPSG:3857, one request per web map tile | GetFeatureInfo; SLD_BODY | `tests/ogc.test.js` › WMS 1.3 |
| OGC WFS 2.0 (09-025r2) | GetCapabilities; GetFeature with BBOX, COUNT / STARTINDEX paging, GeoJSON output; FES 2.0 PropertyIsEqualTo filters | GML 3.2 output parsing (GeoJSON output is required); transactions; stored queries | `tests/ogc.test.js` › WFS 2.0 |
| OGC API - Features Part 1 Core 1.0 (17-069r4) | core, geojson, bbox, limit, next links | HTML encoding | `tests/ogc.test.js` › OGC API Features |
| OGC API - Features Part 2 CRS by Reference 1.0 (18-058) | OGC:CRS84 requested and reprojected to the project CRS on the client | Asking the server for the project CRS | `tests/ogc.test.js` › axis order |
| OGC API - Features Part 3 Filtering (19-079r2) | `filter` with `filter-lang=cql2-text` | CQL2 JSON | `tests/ogc.test.js` › OGC API Features |
| OGC axis order policy (08-038r7) | EPSG:4326 and `urn:ogc:def:crs:EPSG::4326` latitude first; OGC:CRS84 longitude first; a server answering the other way round is detected and swapped | — | `tests/ogc.test.js` › axis order |

## Documents and encodings

| Standard | Implemented | Not implemented | Tests |
|---|---|---|---|
| OGC OWS Context GeoJSON 1.0 (14-055r2) | core; WMTS, WMS, WFS offerings; styles as SE; reading other writers' WMTS / WMS / WFS offerings | Atom encoding | `tests/ogc.test.js` › OWS Context |
| OGC Symbology Encoding 1.1 (05-077r4) / SLD 1.1 (05-078r4) | LineSymbolizer, PolygonSymbolizer, PointSymbolizer (well-known circle), TextSymbolizer from a property, PropertyIsEqualTo rules with an ElseFilter | Graphics, functions, scale ranges | `tests/ogc.test.js` › SLD / SE |
| OGC GeoPackage 1.4 (12-128r19) | Feature tables with GeoPackage geometry blobs (ISO WKB, 2D and 3D), gpkg_spatial_ref_sys with the EPSG code, gpkg_contents extents, gpkg_geometry_columns; read and write | Tile tables (offline tiles stay in the app's cache); extensions | `tests/ogc.test.js` › GeoPackage |
| OGC InfraGML 1.0 Part 6 Survey (16-106r2) | The field book model (Survey, Equipment, InstrumentSetup, Observation, SurveyResult); export with the Part 6 schema element names (`lis:Survey`, `liso:InstrumentPoint`, `liso:AngularObservation`, `liso:DistanceObservation`, `liso:GnssObservation`, `lisr:TargetPoint`) | Import; validation against the XSD (the export is not schema-validated yet) | `tests/fieldbook.test.js` › export |
| OGC WKT-CRS 2 (ISO 19162, 18-010r11) | Reading PROJCRS (and WKT1 PROJCS) for Transverse Mercator and Lambert conformal conic (2SP), with the EPSG id | Datum transformations from WKT; other projection methods | `tests/ogc.test.js` › coordinate engine |
| GeoJSON (RFC 7946, OGC API - Features encoding) | Read and write, properties kept, EPSG CRS URN on export | — | `tests/gis.test.js` |
| CityGML / CityJSON | Not yet | — | — |

## Related open standards

| Standard | Use |
|---|---|
| LandXML 1.2 | Points, surfaces, alignments, linework and survey field books (Survey: InstrumentSetup, Backsight, TargetSetup, RawObservation, GPSSetup, GPSVector), both ways |
| IFC 4 / 4.3 | BIM elements, property sets, georeferencing |
| Trimble JobXML | Field books from Trimble Access and General Survey (import) |
| EPSG | Coordinate systems by code; `urn:ogc:def:crs:EPSG::n` URNs on export |

## Coordinate operations

Projections are computed by the app (`src/core/geomap.js`): Transverse Mercator (UTM zones and national grids), Lambert conformal conic, Web Mercator, and a Trimble job's own projection record. ECEF and seven-parameter Helmert transformations are available. Geoid grids are not applied: heights stay as the job or file gives them, and map layers are placed with the datum taken as WGS 84 (about a metre for some national datums, enough to place a map, not for survey work).
