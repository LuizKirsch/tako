// GraphQL queries for GitHub Projects (v2).
//
// Written from the public GraphQL schema (ProjectV2, ProjectV2SingleSelectField).
// Real responses captured with `gh api graphql` live in test/fixtures/github.
// `first: 100` is enough for the MVP; pagination comes when someone needs it.

export const LIST_PROJECTS = /* GraphQL */ `
  query ListProjects {
    viewer {
      login
      projectsV2(first: 100) {
        nodes { id number title closed }
      }
      organizations(first: 100) {
        nodes {
          login
          projectsV2(first: 100) {
            nodes { id number title closed }
          }
        }
      }
    }
  }
`;

export const LIST_COLUMN_FIELDS = /* GraphQL */ `
  query ListColumnFields($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 100) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
`;
