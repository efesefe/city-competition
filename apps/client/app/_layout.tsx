import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../lib/session";
import { colors, fonts } from "../lib/theme";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: fonts.display, fontWeight: "700" },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "City Competition" }} />
        <Stack.Screen name="auth" options={{ title: "Oynamaya devam et" }} />
        <Stack.Screen name="pick-tribe" options={{ title: "Kabile seç" }} />
        <Stack.Screen name="scoreboard" options={{ title: "Season 0 · Boards" }} />
        <Stack.Screen name="shop" options={{ title: "Dükkan" }} />
        <Stack.Screen name="admin" options={{ title: "Admin — Season 0 ops" }} />
      </Stack>
    </SessionProvider>
  );
}
