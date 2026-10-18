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

// Every single-select value is fetched (not only the column field) because
// GraphQL cannot filter field values by field ID; the parser picks the right one.
// Bodies come with the list so opening a card is instant (no second request).
export const LIST_CARDS = /* GraphQL */ `
  query ListCards($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            isArchived
            fieldValues(first: 30) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  optionId
                  field { ... on ProjectV2SingleSelectField { id } }
                }
              }
            }
            content {
              __typename
              ... on Issue {
                id number title url state body
                repository { nameWithOwner }
                labels(first: 20) { nodes { name } }
                assignees(first: 10) { nodes { login } }
              }
              ... on PullRequest {
                id number title url state body
                repository { nameWithOwner }
                labels(first: 20) { nodes { name } }
                assignees(first: 10) { nodes { login } }
              }
              ... on DraftIssue {
                title body
                assignees(first: 10) { nodes { login } }
              }
            }
          }
        }
      }
    }
  }
`;

// Comments are fetched only when a card is opened: bringing them with the
// board would multiply the response size by the number of cards.
// `last: 100` keeps the newest ones, still in chronological order.
export const LIST_COMMENTS = /* GraphQL */ `
  query ListComments($id: ID!) {
    node(id: $id) {
      ... on Issue {
        comments(last: 100) { nodes { author { login } body createdAt } }
      }
      ... on PullRequest {
        comments(last: 100) { nodes { author { login } body createdAt } }
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
