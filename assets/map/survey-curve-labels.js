// PMB 12 pp78–79, road-aligned-v1 Castle Oaks drawings. Display metadata only.
// Coordinate fingerprints prevent stale recorded labels after vertex edits.
export const surveyCurves = {
  "castle-oaks-survey-parcel-1": [
    {
      "start": 7,
      "end": 23,
      "name": "C1",
      "radius": 465.19,
      "length": 214.57,
      "signature": "cf764da5"
    },
    {
      "start": 24,
      "end": 27,
      "name": "C12",
      "radius": 123,
      "length": 18.36,
      "signature": "307d767c"
    }
  ],
  "castle-oaks-survey-parcel-2": [
    {
      "start": 3,
      "end": 24,
      "name": "C2",
      "radius": 210,
      "length": 185.08,
      "signature": "1973196"
    },
    {
      "start": 24,
      "end": 33,
      "name": "C3",
      "radius": 947.81,
      "length": 160.34,
      "signature": "d0bcb809"
    },
    {
      "start": 34,
      "end": 59,
      "name": "C4",
      "radius": 600,
      "length": 378.56,
      "signature": "c608e1a4"
    }
  ],
  "castle-oaks-survey-parcel-3": [
    {
      "start": 4,
      "end": 26,
      "name": "C10",
      "radius": 222,
      "length": 204.39,
      "signature": "2a46c06a"
    },
    {
      "start": 27,
      "end": 61,
      "name": "C9",
      "radius": 100,
      "length": 213.8,
      "signature": "5b3dff2f"
    },
    {
      "start": 62,
      "end": 88,
      "name": "C8",
      "radius": 410,
      "length": 324.4,
      "signature": "36a3a42"
    },
    {
      "start": 89,
      "end": 135,
      "name": "C7",
      "radius": 460,
      "length": 623.55,
      "signature": "c4051832"
    },
    {
      "start": 136,
      "end": 165,
      "name": "C6",
      "radius": 75,
      "length": 155.55,
      "signature": "c257287e"
    },
    {
      "start": 166,
      "end": 178,
      "name": "C5",
      "radius": 1000,
      "length": 227.47,
      "signature": "63d3126b"
    }
  ],
  "castle-oaks-survey-parcel-4": [
    {
      "start": 7,
      "end": 19,
      "name": "C5",
      "radius": 1000,
      "length": 227.47,
      "signature": "63d3126b"
    },
    {
      "start": 21,
      "end": 46,
      "name": "C4",
      "radius": 600,
      "length": 378.56,
      "signature": "67571800"
    },
    {
      "start": 47,
      "end": 56,
      "name": "C3",
      "radius": 947.81,
      "length": 160.34,
      "signature": "a12f9979"
    },
    {
      "start": 56,
      "end": 77,
      "name": "C2",
      "radius": 210,
      "length": 185.08,
      "signature": "95036da6"
    },
    {
      "start": 77,
      "end": 93,
      "name": "C1",
      "radius": 465.19,
      "length": 214.57,
      "signature": "cf764da5"
    },
    {
      "start": 94,
      "end": 97,
      "name": "C12",
      "radius": 123,
      "length": 18.36,
      "signature": "307d767c"
    }
  ],
  "castle-oaks-survey-parcel-5": [
    {
      "start": 3,
      "end": 32,
      "name": "C6",
      "radius": 75,
      "length": 155.55,
      "signature": "f745a9b6"
    },
    {
      "start": 33,
      "end": 79,
      "name": "C7",
      "radius": 460,
      "length": 623.55,
      "signature": "bf651d0e"
    },
    {
      "start": 80,
      "end": 106,
      "name": "C8",
      "radius": 410,
      "length": 324.4,
      "signature": "a961d532"
    },
    {
      "start": 107,
      "end": 141,
      "name": "C9",
      "radius": 100,
      "length": 213.8,
      "signature": "923a172f"
    },
    {
      "start": 142,
      "end": 164,
      "name": "C10",
      "radius": 222,
      "length": 204.39,
      "signature": "ed0f88f2"
    }
  ],
  "castle-oaks-survey-parcel-6": [],
  "castle-oaks-survey-parcel-7": []
};

export function curveSignature(points) {
  let hash = 2166136261;
  for (const char of points.map(point => point.map(value => value.toFixed(10)).join(',')).join(';')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

export function drawingCurves(drawing) {
  const vertices = drawing.vertices;
  return (surveyCurves[drawing.id] || []).filter(curve =>
    curve.start < vertices.length && curve.end <= vertices.length &&
    curveSignature(Array.from({ length: curve.end - curve.start + 1 }, (_,i) => vertices[(curve.start + i) % vertices.length])) === curve.signature
  );
}
