import { Theme, Button, TextField, Flex, Text, Card } from "@radix-ui/themes";
import { useState } from "react";
import { client } from "@/steel-client";
import { useNavigate } from "react-router-dom";
import { getSessions } from "@/steel-client";

export function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // Update client headers with token
      client.setConfig({
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // Verify we can get sessions
      const { error, data } = await getSessions();
      if (error || !data) {
        throw new Error("Invalid token");
      }

      // Store the token only after successful verification
      localStorage.setItem("auth_token", token);
      navigate("/");
    } catch (err) {
      setError("Invalid token");
      localStorage.removeItem("auth_token");
      client.setConfig({
        headers: {},
      });
    }
  };

  return (
    <Theme>
      <Flex justify="center" align="center" style={{ minHeight: "100vh" }}>
        <Card size="3" style={{ width: "100%", maxWidth: "400px" }}>
          <form onSubmit={handleLogin}>
            <Flex direction="column" gap="4">
              <Text size="5" weight="bold">
                Enter API Token
              </Text>

              {error && (
                <Text color="red" size="2">
                  {error}
                </Text>
              )}

              <TextField.Root
                placeholder="Enter your API token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              ></TextField.Root>

              <Button type="submit">Sign In</Button>
            </Flex>
          </form>
        </Card>
      </Flex>
    </Theme>
  );
}
