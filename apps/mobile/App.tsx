import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { type ServerConfig } from "@t3tools/contracts";

const mockConfig: ServerConfig = {
  cwd: "/workspace/t3code",
  providers: [
    {
      provider: "codex",
      status: "ready",
      available: true,
      authStatus: "unknown",
      checkedAt: new Date().toISOString(),
      message: "Connect this screen to the backend WebSocket when ready.",
    },
    {
      provider: "claudeAgent",
      status: "warning",
      available: false,
      authStatus: "unknown",
      checkedAt: new Date().toISOString(),
      message: "Provider availability will come from server.getConfig.",
    },
  ],
};

export default function App() {
  const providers = useMemo(() => mockConfig.providers, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>T3 Code Mobile</Text>
          <Text style={styles.title}>React Native client for the existing orchestration backend</Text>
          <Text style={styles.subtitle}>
            This app replaces the old desktop and web frontends. The backend remains focused on
            provider sessions, orchestration, git workflows, persistence, and attachments.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Backend connection</Text>
          <TextInput
            editable={false}
            style={styles.input}
            value="ws://localhost:3773"
            placeholder="Backend WebSocket URL"
            placeholderTextColor="#6b7280"
          />
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Connect backend</Text>
          </Pressable>
          <Text style={styles.helperText}>
            Wire this button to the shared WebSocket transport when you are ready to connect the
            mobile client.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Launch scope</Text>
          {[
            "Project list and thread list",
            "Chat thread timeline and composer",
            "Session/provider status from server.getConfig",
            "Attachment-aware turn submission",
            "Orchestration snapshots and live domain events",
          ].map((item) => (
            <View key={item} style={styles.listRow}>
              <View style={styles.listDot} />
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Provider health</Text>
          {providers.map((provider) => (
            <View key={provider.provider} style={styles.providerRow}>
              <View>
                <Text style={styles.providerName}>{provider.provider}</Text>
                <Text style={styles.providerMeta}>{provider.message ?? "No status message"}</Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  provider.status === "ready"
                    ? styles.statusReady
                    : provider.status === "warning"
                      ? styles.statusWarning
                      : styles.statusError,
                ]}
              >
                <Text style={styles.statusLabel}>{provider.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#020617",
  },
  content: {
    padding: 20,
    gap: 16,
  },
  hero: {
    gap: 12,
    marginTop: 12,
  },
  eyebrow: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: "#f8fafc",
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 38,
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    borderRadius: 14,
    borderWidth: 1,
    color: "#94a3b8",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#eff6ff",
    fontSize: 16,
    fontWeight: "700",
  },
  helperText: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 20,
  },
  listRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  listDot: {
    backgroundColor: "#38bdf8",
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  listText: {
    color: "#e2e8f0",
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  providerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  providerName: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  providerMeta: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 4,
    maxWidth: 220,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusReady: {
    backgroundColor: "#166534",
  },
  statusWarning: {
    backgroundColor: "#92400e",
  },
  statusError: {
    backgroundColor: "#991b1b",
  },
  statusLabel: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
});
