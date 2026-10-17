import { render, Text, Box } from "ink";

function App() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>gh-relay</Text>
      <Text dimColor>Toolchain is working.</Text>
    </Box>
  );
}

render(<App />);