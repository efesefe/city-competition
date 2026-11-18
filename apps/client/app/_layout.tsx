import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";
import {
  Unbounded_700Bold,
  Unbounded_800ExtraBold,
} from "@expo-google-fonts/unbounded";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SessionProvider } from "../lib/session";
import { colors, fonts } from "../lib/theme";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts([
    {
      fontFamily: fonts.display,
      fontDefinitions: [
        { path: Unbounded_700Bold, weight: 700 },
        { path: Unbounded_800ExtraBold, weight: 800 },
      ],
    },
    {
      fontFamily: fonts.body,
      fontDefinitions: [
        { path: Figtree_400Regular, weight: 400 },
        { path: Figtree_500Medium, weight: 500 },
        { path: Figtree_600SemiBold, weight: 600 },
        { path: Figtree_700Bold, weight: 700 },
      ],
    },
  ]);

  if (!fontsLoaded && !fontError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

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
        <Stack.Screen name="index" options={{ headerShown: false, title: "City Competition" }} />
        <Stack.Screen name="auth" options={{ title: "Oynamaya devam et" }} />
        <Stack.Screen name="pick-tribe" options={{ title: "Kabile seç" }} />
        <Stack.Screen name="scoreboard" options={{ title: "Season 0 · Boards" }} />
        <Stack.Screen name="shop" options={{ title: "Dükkan" }} />
        <Stack.Screen name="admin" options={{ title: "Admin — Season 0 ops" }} />
      </Stack>
    </SessionProvider>
  );
}
