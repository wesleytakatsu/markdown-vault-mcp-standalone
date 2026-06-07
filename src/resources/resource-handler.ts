export interface IResourceHandler {
  readonly uriPattern: string;

  list(): Promise<Array<{
    description: string;
    mimeType: string;
    name: string;
    size?: number;
    uri: string;
  }>>;

  read(uri: string): Promise<{
    contents: Array<{
      mimeType: string;
      text: string;
      uri: string;
    }>;
  }>;
}
