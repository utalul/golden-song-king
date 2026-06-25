export default function RankingCard({
  players
}) {

  const sortedPlayers =
    [...players].sort(
      (a, b) =>
        b.score - a.score
    );

  return (
    <div
      style={{
        marginTop: "20px"
      }}
    >
      <h2
        style={{
          textAlign: "center",
          marginBottom: "20px"
        }}
      >
        🏆 即時排行榜
      </h2>

      {sortedPlayers.map(
        (
          player,
          index
        ) => {

          let medal = "";

          if (index === 0)
            medal = "🥇";

          else if (
            index === 1
          )
            medal = "🥈";

          else if (
            index === 2
          )
            medal = "🥉";

          return (
            <div
              key={player.id}
              style={{
                background:
                  "#1e293b",

                padding:
                  "14px",

                borderRadius:
                  "14px",

                marginBottom:
                  "10px",

                display:
                  "flex",

                justifyContent:
                  "space-between",

                alignItems:
                  "center",

                boxShadow:
                  "0 4px 10px rgba(0,0,0,.25)"
              }}
            >
              <span
                style={{
                  fontSize:
                    "18px",

                  fontWeight:
                    "bold"
                }}
              >
                {medal} {player.name}
              </span>

              <span
                style={{
                  fontSize:
                    "18px",

                  color:
                    "#facc15",

                  fontWeight:
                    "bold"
                }}
              >
                {player.score} 分
              </span>
            </div>
          );

        }
      )}

    </div>
  );

}