import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function ReconciliationAppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#173f36",
          color: "white",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            border: "9px solid #d7b96e",
            borderRadius: 42,
            display: "flex",
            height: 116,
            justifyContent: "center",
            width: 116,
          }}
        >
          <div
            style={{
              display: "flex",
              height: 58,
              position: "relative",
              width: 69,
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: 6,
                bottom: 13,
                height: 12,
                left: 3,
                position: "absolute",
                transform: "rotate(45deg)",
                width: 31,
              }}
            />
            <div
              style={{
                background: "white",
                borderRadius: 6,
                bottom: 22,
                height: 12,
                left: 22,
                position: "absolute",
                transform: "rotate(-45deg)",
                width: 53,
              }}
            />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
