import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../lib/session";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0b1f17" },
          headerTintColor: "#f4e7c5",
          headerTitleStyle: { fontFamily: "Georgia", fontWeight: "700" },
          contentStyle: { backgroundColor: "#0b1f17" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "City Competition" }} />
        <Stack.Screen name="auth" options={{ title: "Oynamaya devam et" }} />
        <Stack.Screen name="pick-tribe" options={{ title: "Kabile seç" }} />
        <Stack.Screen name="scoreboard" options={{ title: "Season 0 · Boards" }} />
        <Stack.Screen name="shop" options={{ title: "Dükkan (stub)" }} />
        <Stack.Screen name="admin" options={{ title: "Admin — maç günü" }} />
      </Stack>
    </SessionProvider>
  );
}
