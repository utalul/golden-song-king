import { theme } from "../theme/theme";

export default function Card({

  children,

  style = {}

}) {

  return (

    <div
      style={{
        background:
          theme.colors.card,

        borderRadius:
          theme.radius.card,

        padding:
          theme.spacing.card,

        boxShadow:
          theme.shadow.card,

        marginBottom:
          theme.spacing.gap,

        ...style
      }}
    >
      {children}
    </div>

  );

}