export type ViewerPosition = { latitude: number; longitude: number; accuracy: number; time: string };
export type SelectedPosition = ViewerPosition & { id: string; name: string };
