import { theme } from "../theme/theme";

export default function AppLogo() {
  return (
    <div
      style={{
        textAlign: "center",
        marginBottom: "30px"
      }}
    >
      <div
        style={{
          fontSize: "52px",
          marginBottom: "10px"
        }}
      >
        🎵
      </div>

      <h1
        style={{
          color: theme.colors.gold,
          margin: 0,
          fontSize: "38px",
          fontWeight: "bold"
        }}
      >
        金曲猜歌王
      </h1>

      <p
        style={{
          marginTop: "8px",
          color: theme.colors.subText,
          letterSpacing: "3px",
          fontSize: "15px"
        }}
      >
        黃金歌王
      </p>
    </div>
  );
}
