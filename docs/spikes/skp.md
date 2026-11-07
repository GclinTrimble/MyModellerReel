# Spike: SketchUp (.skp) import and export (#155)

## Question

Can MyModellerReel open and write `.skp` files directly, keeping tags, components, groups, materials, scenes and
the geolocation?

## Findings

- `.skp` is a closed binary format. The only supported reader / writer is the **SketchUp C SDK** (`SketchUpAPI`),
  a native library for Windows and macOS, downloaded from the Trimble / SketchUp developer site after signing in and
  accepting its licence. There is no maintained open-source reader.
- The SDK maps one to one onto what we already have:
  | SketchUp | MyModellerReel |
  | --- | --- |
  | Tags (layers) | layers (`doc.tags`, #138) |
  | Component definitions / instances | components (`doc.components`, instances as groups) |
  | Groups | groups |
  | Faces with holes, soft / smooth edges | meshes (faces are polygons; holes via imprint) |
  | Materials and textures | materials (textures: #57) |
  | Scenes | scenes |
  | Geo-location (lat / long + model origin) | base point (no reprojection: the SDK gives the origin) |
- How it would run: a small helper executable built against the SDK (C, ~400 lines: walk the model, write JSON;
  read JSON, build the model), shipped next to the app and called from the main process like the AI proxy. The
  renderer never loads native code. Our JSON document is already the exchange shape, so the helper stays thin.
- Licence: the SDK licence allows redistribution of the runtime DLLs with an application; it needs to be read and
  accepted by the product owner (Trimble account) before the SDK is downloaded or shipped.

## Today, without the SDK

- **SketchUp → MyModellerReel**: export from SketchUp to **IFC** (keeps tags as layers and classifications) or
  **glTF / DAE**, then `import` here. IFC is the better path for BIM data; DXF for 2D linework.
- **MyModellerReel → SketchUp**: `export` to **IFC** (SketchUp Pro imports IFC with its structure) or **DXF**
  (linework and layers), or **glb** for geometry.

## Decision needed

1. The product owner downloads the SDK and accepts its licence (Trimble developer account).
2. Then: build the helper (`tools/skp-helper/`), register an `skp` format whose `read` / `write` call it, and add
   round-trip fixtures.
