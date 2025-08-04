export interface YouTubeAuthWindow {
  google: {
    accounts: {
      oauth2: {
        initTokenClient: (config: any) => any;
      };
    };
  };
}

declare global {
  interface Window extends YouTubeAuthWindow {}
}
