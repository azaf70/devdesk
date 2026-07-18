import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1419",
          borderRadius: 8,
          border: "1.5px solid rgba(61, 214, 198, 0.4)",
          position: "relative",
        }}
      >
        {/* prompt > */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginRight: 3,
            marginTop: 1,
          }}
        >
          <div
            style={{
              width: 8,
              height: 2.5,
              background: "#3dd6c6",
              borderRadius: 2,
              transform: "rotate(35deg)",
              marginBottom: -1,
            }}
          />
          <div
            style={{
              width: 8,
              height: 2.5,
              background: "#3dd6c6",
              borderRadius: 2,
              transform: "rotate(-35deg)",
            }}
          />
        </div>
        {/* cursor _ */}
        <div
          style={{
            width: 8,
            height: 2.5,
            background: "#3dd6c6",
            borderRadius: 2,
            marginTop: 8,
            marginLeft: 1,
          }}
        />
        {/* live status */}
        <div
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 5,
            height: 5,
            borderRadius: 99,
            background: "#3dd6c6",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
