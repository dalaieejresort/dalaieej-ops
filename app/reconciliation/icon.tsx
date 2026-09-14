import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function ReconciliationIcon() {
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
            border: "24px solid #d7b96e",
            borderRadius: 120,
            display: "flex",
            height: 320,
            justifyContent: "center",
            width: 320,
          }}
        >
          <div
            style={{
              display: "flex",
              height: 160,
              position: "relative",
              width: 190,
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: 16,
                bottom: 35,
                height: 34,
                left: 8,
                position: "absolute",
                transform: "rotate(45deg)",
                width: 85,
              }}
            />
            <div
              style={{
                background: "white",
                borderRadius: 16,
                bottom: 61,
                height: 34,
                left: 61,
                position: "absolute",
                transform: "rotate(-45deg)",
                width: 145,
              }}
            />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
